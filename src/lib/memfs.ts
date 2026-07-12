/**
 * In-memory FileSystemDirectoryHandle shim for E2E tests (?e2e=1): the whole
 * app — fs layer, git adapter, editors — runs against it unchanged, no native
 * directory picker involved. Implements exactly the surface lib/fs.ts and
 * lib/gitfs.ts use.
 */

interface MemFile {
  kind: 'file'
  data: Uint8Array
  lastModified: number
}

interface MemDir {
  kind: 'dir'
  entries: Map<string, MemFile | MemDir>
}

function notFound(name: string): DOMException {
  return new DOMException(`${name} not found`, 'NotFoundError')
}

class MemFileHandle {
  readonly kind = 'file' as const
  constructor(
    public name: string,
    private file: MemFile,
  ) {}

  async getFile(): Promise<File> {
    return new File([this.file.data as Uint8Array<ArrayBuffer>], this.name, {
      lastModified: this.file.lastModified,
    })
  }

  async createWritable(): Promise<{
    write(data: unknown): Promise<void>
    close(): Promise<void>
  }> {
    const chunks: Uint8Array[] = []
    const file = this.file
    return {
      async write(data: unknown) {
        if (typeof data === 'string') chunks.push(new TextEncoder().encode(data))
        else if (data instanceof Blob) chunks.push(new Uint8Array(await data.arrayBuffer()))
        else if (data instanceof ArrayBuffer) chunks.push(new Uint8Array(data))
        else chunks.push(new Uint8Array(data as ArrayBufferView['buffer']))
      },
      async close() {
        const total = chunks.reduce((n, c) => n + c.length, 0)
        const merged = new Uint8Array(total)
        let off = 0
        for (const c of chunks) {
          merged.set(c, off)
          off += c.length
        }
        file.data = merged
        file.lastModified = Date.now()
      },
    }
  }
}

class MemDirHandle {
  readonly kind = 'directory' as const
  constructor(
    public name: string,
    private dir: MemDir,
  ) {}

  async getDirectoryHandle(name: string, opts?: { create?: boolean }): Promise<MemDirHandle> {
    let entry = this.dir.entries.get(name)
    if (!entry) {
      if (!opts?.create) throw notFound(name)
      entry = { kind: 'dir', entries: new Map() }
      this.dir.entries.set(name, entry)
    }
    if (entry.kind !== 'dir') throw new DOMException(name, 'TypeMismatchError')
    return new MemDirHandle(name, entry)
  }

  async getFileHandle(name: string, opts?: { create?: boolean }): Promise<MemFileHandle> {
    let entry = this.dir.entries.get(name)
    if (!entry) {
      if (!opts?.create) throw notFound(name)
      entry = { kind: 'file', data: new Uint8Array(), lastModified: Date.now() }
      this.dir.entries.set(name, entry)
    }
    if (entry.kind !== 'file') throw new DOMException(name, 'TypeMismatchError')
    return new MemFileHandle(name, entry)
  }

  async removeEntry(name: string, opts?: { recursive?: boolean }): Promise<void> {
    const entry = this.dir.entries.get(name)
    if (!entry) throw notFound(name)
    if (entry.kind === 'dir' && entry.entries.size > 0 && !opts?.recursive) {
      throw new DOMException(name, 'InvalidModificationError')
    }
    this.dir.entries.delete(name)
  }

  async *values(): AsyncGenerator<MemFileHandle | MemDirHandle> {
    for (const [name, entry] of this.dir.entries) {
      yield entry.kind === 'file' ? new MemFileHandle(name, entry) : new MemDirHandle(name, entry)
    }
  }

  async *keys(): AsyncGenerator<string> {
    for (const name of this.dir.entries.keys()) yield name
  }

  async queryPermission(): Promise<PermissionState> {
    return 'granted'
  }

  async requestPermission(): Promise<PermissionState> {
    return 'granted'
  }

  async isSameEntry(other: unknown): Promise<boolean> {
    return other === this
  }
}

/** A fresh, empty in-memory "folder" masquerading as a directory handle. */
export function createMemoryRoot(name = 'e2e-kb'): FileSystemDirectoryHandle {
  const root: MemDir = { kind: 'dir', entries: new Map() }
  return new MemDirHandle(name, root) as unknown as FileSystemDirectoryHandle
}
