import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('evidence', Path(__file__).resolve().parents[1] / 'tools/evidence.py')
e = importlib.util.module_from_spec(spec)
spec.loader.exec_module(e)


class EvidenceTests(unittest.TestCase):
    def test_completed_research_with_unmeasured_benchmarks_is_ready_not_requeued(self):
        evidence = {'schema_version': 2, 'evidence_as_of': '2020-01-01',
                    'sources': {'source': {'retrieved_at': '2020-01-01'}},
                    'alias_index': {'p/m': 'm'}, 'models': {'m': {
                        'positioning': 'Bounded coding model', 'source_keys': ['source'],
                        'last_researched_at': '2020-01-01',
                        'capabilities': {'coding': {'rating': 'unknown', 'confidence': 'low',
                                                  'note': 'Searched; no comparable benchmark'}},
                        'research_gaps': ['No exact hosted-SKU benchmark published']}}}
        roster = {'eligible_models': [{'id': 'p/m'}]}
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            e.write(root / 'routing/model-evidence.json', evidence)
            e.write(root / 'routing/model-roster.json', roster)
            self.assertEqual(e.complete(root)['completed_routes'], 1)
            saved = e.read(root / 'routing/model-evidence.json')
            self.assertEqual(saved['advisor_readiness'], 'READY')
            self.assertEqual(saved['models'], evidence['models'])
            self.assertEqual(saved['sources'], evidence['sources'])
            self.assertEqual(saved['evidence_as_of'], '2020-01-01')
            report = e.status(saved, roster)
            self.assertEqual(report['next_batch'], [])
            self.assertEqual(len(report['disclosed_limitations']), 1)
            roster['eligible_models'].append({'id': 'p/new'})
            e.write(root / 'routing/model-roster.json', roster)
            self.assertEqual(e.coverage(saved, roster)['status'], 'needs_research')
            with self.assertRaises(ValueError):
                e.complete(root)

    def test_missing_routes_and_all_unknown_capabilities_are_actionable(self):
        evidence = {'sources': {'s': {}}, 'alias_index': {'p/m': 'm', 'q/m': 'm', 'p/gone': 'gone'},
                    'models': {'m': {'positioning': 'model', 'source_keys': ['s'],
                                     'last_researched_at': '2020-01-01',
                                     'capabilities': {'coding': {'rating': 'strong'},
                                                      'tool_use': {'rating': 'strong'},
                                                      'reasoning': {'rating': 'unknown'}}}}}
        roster = {'eligible_models': [{'id': r} for r in ['p/m', 'q/m', 'p/new', 'p/gone']]}
        result = e.status(evidence, roster)
        self.assertEqual(result['next_batch'], [])
        self.assertEqual(result['counts']['routes_needing_registration'], 2)
        self.assertEqual({r['route'] for r in result['routes_needing_registration']}, {'p/new', 'p/gone'})
        self.assertEqual(result['disclosed_limitations'][0]['unmeasured_capabilities'], ['reasoning'])
        del evidence['models']['m']['positioning']
        result = e.status(evidence, roster)
        self.assertEqual(result['counts']['models_needing_research'], 1)
        self.assertEqual(result['next_batch'][0]['routes'], ['p/m', 'q/m'])

    def test_duplicate_key_rejected(self):
        with self.assertRaises(ValueError):
            json.loads('{"models":{},"models":{}}', object_pairs_hook=e.pairs)

    def test_batch_is_atomic_and_stale_or_unsourced_batch_cannot_replace_cache(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            target = root / 'routing/model-evidence.json'
            e.write(target, {'schema_version': 2, 'evidence_as_of': '2020-01-01', 'sources': {}, 'alias_index': {'p/m': 'm'}, 'models': {'m': {}}})
            e.write(root / 'routing/model-roster.json', {'eligible_models': [{'id': 'p/m'}]})
            before = target.read_bytes()
            batch = {'base_sha256': 'stale', 'models': {'m': {'positioning': 'new'}}}
            with self.assertRaises(ValueError):
                e.apply(root, batch)
            batch['base_sha256'] = e.digest(target)
            batch['models']['m'] = {'capabilities': {'coding': {'rating': 'strong', 'confidence': 'high', 'evidence': ['missing']}}}
            with self.assertRaises(ValueError):
                e.apply(root, batch)
            self.assertEqual(target.read_bytes(), before)
            batch['models']['m'] = {'research_gaps': ['Searched; no published score found']}
            e.apply(root, batch)
            self.assertEqual(e.read(target)['evidence_as_of'], '2020-01-01')
            self.assertEqual(e.read(target)['models']['m']['research_gaps'], batch['models']['m']['research_gaps'])

    def test_context_evidence_and_inventory_aliases_are_validated(self):
        errors = e.validate({'schema_version': 2, 'models': {'m': {'context': {'input_tokens': -1, 'evidence': ['missing']}}}, 'alias_index': {}, 'sources': {}}, {'eligible_models': [{'id': 'p/m'}]})
        self.assertEqual(len(errors), 3)

    def test_interrupted_commit_replays_and_os_lock_is_released(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            target = root / 'routing/model-evidence.json'
            e.write(target, {'schema_version': 2, 'sources': {}, 'alias_index': {'p/m': 'm'}, 'models': {'m': {}}})
            e.write(root / 'routing/model-roster.json', {'eligible_models': [{'id': 'p/m'}]})
            batch = {'base_sha256': e.digest(target), 'models': {'m': {'research_gaps': ['checked']}}}
            original = e.write
            def interrupted(path, value):
                if value.get('status') == 'applied':
                    raise OSError('simulated interruption after cache replacement')
                original(path, value)
            with patch.object(e, 'write', interrupted), self.assertRaises(OSError):
                e.apply(root, batch)
            self.assertEqual(e.read(target)['models']['m']['research_gaps'], ['checked'])
            self.assertTrue(e.apply(root, batch)['already_applied'])
            self.assertTrue(e.apply(root, batch)['already_applied'])

    def test_capture_proof_is_checked_against_bytes(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            target = root / 'routing/model-evidence.json'
            e.write(target, {'schema_version': 2, 'sources': {}, 'alias_index': {'p/m': 'm'}, 'models': {'m': {}}})
            e.write(root / 'routing/model-roster.json', {'eligible_models': [{'id': 'p/m'}]})
            content = b'public model card'
            proof = {'url': 'https://example.org/card', 'retrieved_at': '2020-01-01T00:00:00Z', 'sha256': e.hashlib.sha256(content).hexdigest()}
            capture = e.hashlib.sha256(json.dumps(proof, sort_keys=True).encode()).hexdigest()
            e.write(root / f'.state/evidence/captures/{capture}.json', proof)
            source = root / f'.state/evidence/captures/{capture}.source'
            source.write_bytes(b'changed')
            batch = {'base_sha256': e.digest(target), 'models': {'m': {'source_keys': ['card']}}, 'sources': {'card': {**proof, 'capture_id': capture}}}
            with self.assertRaises(ValueError):
                e.apply(root, batch)
            source.write_bytes(content)
            self.assertEqual(e.apply(root, batch)['accepted_models'], ['m'])


if __name__ == '__main__':
    unittest.main()
