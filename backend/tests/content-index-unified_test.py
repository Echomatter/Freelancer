import json
import os
import sqlite3
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
INDEXER = ROOT / "backend" / "tools" / "Project_Content_Indexer.py"
SCHEMA = ROOT / "server" / "data" / "schema.sql"


class UnifiedContentIndexTest(unittest.TestCase):
    def run_indexer(self, db: Path, project: Path, key: str, *args: str):
        cp = subprocess.run(
            [sys.executable, str(INDEXER), "--db", str(db), "--project-key", key, *args],
            cwd=project,
            text=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
        )
        self.assertEqual(cp.returncode, 0, cp.stderr)
        return json.loads(cp.stdout)

    def test_two_projects_share_one_database_without_cross_talk(self):
        with tempfile.TemporaryDirectory() as td:
            base = Path(td)
            db = base / "freelancer.sqlite"
            con = sqlite3.connect(db)
            con.executescript(SCHEMA.read_text(encoding="utf-8"))
            con.execute("INSERT INTO drafts VALUES (?,?,?,?,?)", ("project-a", "new", "keep me", 1, 1))
            con.commit()
            con.close()

            a = base / "a"
            b = base / "b"
            a.mkdir()
            b.mkdir()
            (a / "alpha.md").write_text("orchid telescope alpha", encoding="utf-8")
            (b / "beta.md").write_text("cobalt submarine beta", encoding="utf-8")

            self.run_indexer(db, a, "project-a", "rebuild", "--root", str(a))
            self.run_indexer(db, b, "project-b", "rebuild", "--root", str(b))
            check = subprocess.run([os.environ.get("FREELANCER_NODE", "node"), "--input-type=module", "-e",
                "import {DatabaseSync} from 'node:sqlite'; const db=new DatabaseSync(process.argv[1]); "
                "db.exec(\"INSERT INTO content_units_fts(content_units_fts) VALUES('integrity-check')\"); db.close();", str(db)],
                capture_output=True, text=True)
            self.assertEqual(check.returncode, 0, check.stderr)

            alpha = self.run_indexer(db, a, "project-a", "search", "orchid")
            beta = self.run_indexer(db, b, "project-b", "search", "cobalt")
            self.assertEqual(alpha[0]["virtual_path"], "alpha.md")
            self.assertEqual(beta[0]["virtual_path"], "beta.md")
            self.assertEqual(self.run_indexer(db, a, "project-a", "search", "cobalt"), [])
            self.assertEqual(self.run_indexer(db, b, "project-b", "search", "orchid"), [])

            con = sqlite3.connect(db)
            self.assertEqual(con.execute("SELECT text FROM drafts WHERE project_id='project-a'").fetchone()[0], "keep me")
            self.assertEqual(con.execute("SELECT COUNT(*) FROM content_sources").fetchone()[0], 2)
            self.assertEqual(con.execute("PRAGMA user_version").fetchone()[0], 6)
            con.close()

            (a / "alpha.md").write_text("violet telescope alpha", encoding="utf-8")
            self.run_indexer(db, a, "project-a", "rebuild", "--root", str(a))
            self.assertEqual(self.run_indexer(db, a, "project-a", "search", "orchid"), [])
            self.assertEqual(self.run_indexer(db, b, "project-b", "search", "cobalt")[0]["virtual_path"], "beta.md")

            (a / "alpha.md").unlink()
            empty = self.run_indexer(db, a, "project-a", "rebuild", "--root", str(a))
            self.assertEqual(empty["physical_sources_indexed"], 0)
            self.assertEqual(empty["validation"]["integrity"], "ok")
            self.assertEqual(self.run_indexer(db, a, "project-a", "search", "violet"), [])
            self.assertEqual(self.run_indexer(db, b, "project-b", "search", "cobalt")[0]["virtual_path"], "beta.md")

    def test_refresh_reuses_unchanged_sources_and_keeps_per_file_gaps(self):
        with tempfile.TemporaryDirectory() as td:
            base = Path(td)
            db = base / "freelancer.sqlite"
            con = sqlite3.connect(db)
            con.executescript(SCHEMA.read_text(encoding="utf-8"))
            con.close()
            project = base / "project"
            project.mkdir()
            (project / "keep.md").write_text("stable orchid source", encoding="utf-8")
            (project / "change.md").write_text("old cobalt source", encoding="utf-8")

            first = self.run_indexer(db, project, "p", "rebuild", "--root", str(project))
            self.assertEqual(first["refresh_mode"], "full")

            (project / "change.md").write_text("new violet source", encoding="utf-8")
            refreshed = self.run_indexer(db, project, "p", "rebuild", "--root", str(project))
            self.assertEqual(refreshed["refresh_mode"], "incremental")
            self.assertEqual(refreshed["files_reindexed"], 1)
            self.assertEqual(refreshed["files_reused"], 1)
            self.assertEqual(self.run_indexer(db, project, "p", "search", "orchid")[0]["virtual_path"], "keep.md")
            self.assertEqual(self.run_indexer(db, project, "p", "search", "cobalt"), [])
            self.assertEqual(self.run_indexer(db, project, "p", "search", "violet")[0]["virtual_path"], "change.md")



if __name__ == "__main__":
    unittest.main()
