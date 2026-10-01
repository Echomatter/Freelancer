import test from 'node:test';
import assert from 'node:assert/strict';
import { noWriteAssignment } from '../tools/runtime/delegation.mjs';

test('product capability descriptions do not impose inspection authority', () => {
  for (const text of [
    'Implement a read-only effective capabilities view and its tests.',
    'Add debugging and read-only LSP inspection support to every agent.',
    'TOP RULE capability first. Add a read-only inventory. Write the feature and verify it.',
  ]) assert.equal(noWriteAssignment(text), false, text);
});

test('scoped writer exclusions do not disable its owned files', () => {
  for (const text of [
    'Write outcome tests. No edits to implementation; return failures for the parent.',
    'Own tests/example.mjs. No edits outside that file.',
    'Implement the helper. Do not modify files outside the assigned paths.',
    'Write the tests. Do not edit files in src.',
  ]) assert.equal(noWriteAssignment(text), false, text);
});

test('explicit whole-assignment restrictions retain inspection state', () => {
  for (const text of [
    'Read-only orientation; check git status.',
    'READ-ONLY: collect findings and return them.',
    'Please no writes. Inspect the project.',
    'Do not modify any files. Explain the current behavior.',
    'Do not edit source files. Return findings.',
    'No source writes. Verify the existing behavior.',
    'Explain-only: investigate this failure.',
    'Just inspect the source and report findings.',
  ]) assert.equal(noWriteAssignment(text), true, text);
});
