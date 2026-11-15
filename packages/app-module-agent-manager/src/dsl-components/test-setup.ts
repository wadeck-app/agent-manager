import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach, beforeEach } from 'vitest';
import { seedCsrfToken } from './data/http.js';

// Every test starts with the write token already "fetched": the tests of the token itself (data/http.test.ts) reset it.
beforeEach(() => seedCsrfToken('test-token'));
afterEach(() => cleanup());
