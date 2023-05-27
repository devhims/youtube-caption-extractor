// jest.config.ts
import type { Config } from '@jest/types';

// Or import the types and use them directly
// import { Config } from '@jest/types';

const config: Config.InitialOptions = {
  verbose: true,
  preset: 'ts-jest',
  testEnvironment: 'node',
};

export default config;
