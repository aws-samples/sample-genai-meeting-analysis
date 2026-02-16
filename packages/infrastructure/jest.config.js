module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/lambda'],
  testMatch: ['**/*.test.ts'],
  collectCoverageFrom: [
    'lambda/**/*.ts',
    '!lambda/**/*.test.ts',
    '!lambda/**/*.d.ts',
  ],
  moduleNameMapper: {
    '^@meeting-platform/shared$': '<rootDir>/../shared/src/index.ts',
  },
  transform: {
    '^.+\\.tsx?$': ['ts-jest', {
      tsconfig: {
        esModuleInterop: true,
        allowSyntheticDefaultImports: true,
      },
    }],
  },
};
