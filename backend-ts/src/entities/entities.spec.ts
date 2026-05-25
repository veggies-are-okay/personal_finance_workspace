import 'reflect-metadata';

import { ALL_ENTITIES } from './entities';

/**
 * Sanity coverage for the entity declarations.
 *
 * The entities are pure schema declarations (no business logic) — their real
 * verification is the cross-backend schema-parity check in
 * `contracts/test/schema.parity.test.ts`, which proves they mirror the
 * Alembic-owned schema. These tests confirm the classes are registered and
 * constructable (exercising each class body).
 */
describe('ALL_ENTITIES', () => {
  it('exports the full set of P2.3 entities', () => {
    expect(ALL_ENTITIES).toHaveLength(14);
    // No duplicates.
    expect(new Set(ALL_ENTITIES).size).toBe(ALL_ENTITIES.length);
  });

  it('every entity is a constructable class', () => {
    for (const Entity of ALL_ENTITIES) {
      expect(typeof Entity).toBe('function');
      const instance = new Entity();
      expect(instance).toBeInstanceOf(Entity);
    }
  });
});
