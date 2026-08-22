/** @type {import('ts-jest').JestConfigWithTsJest} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/src'],
  // *.db.test.ts files require PGlite (dynamic import / --experimental-vm-modules)
  // and are run separately via `npm run test:db`. Exclude them from the default suite.
  testMatch: ['**/__tests__/**/*.test.ts', '**/*.test.ts'],
  testPathIgnorePatterns: ['\\.db\\.test\\.ts$'],
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
  },
  transform: {
    '^.+\\.ts$': ['ts-jest', {
      tsconfig: {
        module: 'commonjs',
        moduleResolution: 'node',
        esModuleInterop: true,
        strict: false,
        noImplicitAny: false,
      },
    }],
  },
  collectCoverageFrom: [
    'src/lib/**/*.ts',
    '!src/lib/**/*.d.ts',
    // Track the API route layer (business/security/accounting logic) too.
    'src/app/api/**/*.ts',
  ],
  // Ratchet the measured baseline: new code may raise these values but cannot
  // silently reduce the tested share of shared business functions.
  //
  // src/lib/** is held to 100% (statements/branches/functions/lines). The API
  // route layer is large and is being brought up incrementally — the global
  // thresholds below reflect the current blended baseline and are raised as
  // coverage grows; they can never regress without a test going red.
  coverageThreshold: {
    // src/lib/** is held to 100% (statements/branches/functions/lines).
    'src/lib/**/*.ts': {
      statements: 100,
      branches: 100,
      functions: 100,
      lines: 100,
    },
    // global applies to files not matched by a specific glob — i.e. the API
    // route layer (src/lib/** is pinned to 100% above). These are the current
    // measured API baselines and are ratcheted upward as coverage grows.
    global: {
      statements: 77,
      branches: 61,
      functions: 90,
      lines: 72,
    },
  },
};
