# Property Tests

Property tests in this folder should use `fast-check`.

Keep table-driven permutations and scenario matrices in `tests/integration/`
unless they are rewritten as generated property tests.

## Conventions

- Keep generators bounded. Prefer small trees and short operation sequences so
  failures shrink to readable cases. Set explicit `numRuns` values in tests.
- Generate valid tree structure up front. Parent indexes should only point to
  earlier siblings, and generated `indentLevel` values should match parent
  depth.
- Generated window child lists must be valid flattened tree order: parent
  subtrees are contiguous preorder blocks. Do not generate shapes such as root
  A, root B, child of A.
- Materialize background trees through `tests/helpers/tree-fixtures.ts`, then
  assert `expectTreeInvariants()` from `tests/helpers/tree-invariants.ts`.
- Call `resetTree()` inside each property body before materializing generated
  data. This keeps shrunk counterexamples independent of Vitest hook timing.
- Keep background tree properties in saved-state, in-memory APIs. Avoid
  browser-backed operations such as opening, closing, or moving live tabs.
- When a property needs a specific capability, filter or adjust the generated
  input narrowly, such as requiring at least one tab or one note.
- Use property tests for broad invariants and operation sequences. Keep exact
  regression examples in `tests/regression/` or focused integration scenarios
  in `tests/integration/`.
- When `fast-check` reports a failure, keep the seed and path from the output.
  Reproduce by temporarily passing those values to the failing `fc.assert`
  options, or with equivalent runner flags when available.

## Commands

- Run property tests only: `pnpm exec vitest run tests/property`
- Run one property file: `pnpm exec vitest run tests/property/background-tree.property.test.ts`
- Run broad non-E2E verification after property changes: `pnpm test`
- Type-check after property test changes: `pnpm run compile`
