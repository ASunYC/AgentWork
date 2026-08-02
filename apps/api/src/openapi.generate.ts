import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { openApiDocument } from './openapi';

void writeFile(
  resolve(process.cwd(), '../../docs/openapi.json'),
  `${JSON.stringify(openApiDocument, null, 2)}\n`,
);
