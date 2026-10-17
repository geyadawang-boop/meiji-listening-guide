import {createHash} from 'node:crypto'
import {readdir, writeFile} from 'node:fs/promises'
import {createReadStream} from 'node:fs'
import {join, resolve} from 'node:path'

const directory = resolve(process.argv[2] || 'release/lite')
const platform = process.argv[3]
if (!platform || !['win', 'mac', 'linux'].includes(platform)) {
 throw new Error('Expected platform: win, mac, or linux')
}
const files = (await readdir(directory, {withFileTypes: true}))
 .filter(entry => entry.isFile() && /\.(?:exe|dmg|zip|AppImage|deb)$/.test(entry.name))
 .map(entry => entry.name)
 .sort()
if (!files.length) throw new Error('No installers found in ' + directory)
const lines: string[] = []
for (const file of files) {
 const hash = createHash('sha256')
 for await (const chunk of createReadStream(join(directory, file))) hash.update(chunk)
 lines.push(hash.digest('hex') + '  ' + file)
}
await writeFile(join(directory, 'SHA256SUMS-' + platform + '.txt'), lines.join('\n') + '\n')
console.log(lines.join('\n'))
