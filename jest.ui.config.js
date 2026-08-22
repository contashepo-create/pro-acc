/**
 * Jest config for UI/component tests (jsdom + React Testing Library).
 *
 * Kept separate from jest.config.js so the API-route coverage ratchet is
 * unaffected. UI coverage grows independently and is ratcheted here.
 */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'jsdom',
  roots: ['<rootDir>/src'],
  testMatch: ['**/*.test.tsx', '**/__tests__/**/*.test.tsx'],
  testPathIgnorePatterns: ['\\\\.db\\\\.test\\\\.ts$'],
  setupFilesAfterEnv: ['<rootDir>/jest.ui.setup.ts'],
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
    '^next/navigation$': '<rootDir>/src/__tests__/helpers/next-nav-mock.ts',
    '^next/link$': '<rootDir>/src/__tests__/helpers/next-link-mock.ts',
    '^lucide-react$': '<rootDir>/src/__tests__/helpers/lucide-mock.ts',
  },
  transform: {
    '^.+\\\\.tsx?$': ['ts-jest', {
      tsconfig: {
        module: 'commonjs',
        moduleResolution: 'node',
        esModuleInterop: true,
        strict: false,
        noImplicitAny: false,
        jsx: 'react-jsx',
      },
    }],
  },
  collectCoverageFrom: [
    'src/components/**/*.tsx',
    '!src/components/**/*.test.tsx',
    '!src/components/**/index.ts',
  ],
  coverageThreshold: {
    // Aggregate across all components (global applies to the whole run).
    global: {
      statements: 15,
      branches: 11,
      functions: 13,
      lines: 14,
    },
  },
};
