import { copyFile, mkdir } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const projectRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
const outputDirectory = join(projectRoot, 'public', 'fonts')

const fonts = [
  {
    packageName: '@fontsource-variable/inter',
    source: 'files/inter-latin-wght-normal.woff2',
    output: 'Inter-Variable.woff2',
  },
  {
    packageName: '@fontsource-variable/space-grotesk',
    source: 'files/space-grotesk-latin-wght-normal.woff2',
    output: 'SpaceGrotesk-Variable.woff2',
  },
]

await mkdir(outputDirectory, { recursive: true })

for (const font of fonts) {
  const packageRoot = dirname(require.resolve(`${font.packageName}/package.json`))
  await copyFile(join(packageRoot, font.source), join(outputDirectory, font.output))
}

console.log('Installed local Inter and Space Grotesk font assets.')
