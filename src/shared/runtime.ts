export interface RuntimeFile {
 path: string
 size: number
 sha256: string
}
export interface RuntimeComponent {
 id: string
 label: string
 directory: string
 files: RuntimeFile[]
 bytes: number
}
export interface RuntimeManifest {
 schema: 1
 productVersion: string
 components: RuntimeComponent[]
}
export interface RuntimeStatus {
 version: string
 components: Array<{id: string; label: string; bytes: number; installed: boolean}>
}
