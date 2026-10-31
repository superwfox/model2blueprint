/** Owns pending download URLs so unmounting cannot leave browser resources behind. */
export class Downloads {
  private pending = new Map<string, ReturnType<typeof setTimeout>>();

  save(bytes: Uint8Array, filename: string): void {
    const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: 'application/octet-stream' }));
    const release = () => { URL.revokeObjectURL(url); this.pending.delete(url); };
    const timer = setTimeout(release, 30_000); this.pending.set(url, timer);
    try {
      const link = document.createElement('a'); link.href = url;
      link.download = (filename.replace(/\.glb$/i, '').replace(/[<>:"/\\|?*]/g, '_') || 'model') + '.schem';
      link.click();
    } catch (error) { clearTimeout(timer); release(); throw error; }
  }

  dispose(): void {
    for (const [url, timer] of this.pending) { clearTimeout(timer); URL.revokeObjectURL(url); }
    this.pending.clear();
  }
}
