import { promises as fs } from 'fs'
import path from 'path'
import type { Ir } from './schema'
import { irSchema } from './schema'
import { parseIr, serializeIr, irFilePath, IR_DIR_NAME, IR_FILE_NAME } from './serialize'

export {
  IrValidationError,
  parseIr,
  serializeIr,
  irFilePath,
  IR_DIR_NAME,
  IR_FILE_NAME,
} from './serialize'

export async function readIrFile(projectRoot: string): Promise<Ir | null> {
  const filePath = irFilePath(projectRoot)

  let raw: string
  try {
    raw = await fs.readFile(filePath, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw error
  }

  return parseIr(raw)
}

export async function writeIrFile(projectRoot: string, ir: Ir): Promise<string> {
  const validated = irSchema.parse(ir)
  const filePath = irFilePath(projectRoot)
  await fs.mkdir(path.dirname(filePath), { recursive: true })
  const yaml = serializeIr(validated)
  await fs.writeFile(filePath, yaml, 'utf8')
  return filePath
}
