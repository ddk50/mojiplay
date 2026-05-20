/** @type {import('ts-jest').JestConfigWithTsJest} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/test'],
  moduleFileExtensions: ['ts', 'js'],
  transform: {
    '^.+\\.ts$': ['ts-jest', { tsconfig: 'tsconfig.test.json' }],
  },
  // 本番 (esbuild) では .svg を text loader で string として import するが、
  // jest にはその loader が無いので解決失敗する。テストは iconSvg 中身に
  // 依存しないので、ダミー文字列を返すスタブに mapping する。
  moduleNameMapper: {
    '\\.svg$': '<rootDir>/test/svg-stub.ts',
  },
};
