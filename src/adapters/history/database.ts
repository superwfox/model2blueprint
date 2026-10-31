import type { HistoryBootstrap, HistoryEntry, HistorySnapshot, HistoryView, HistoryWrite } from './types.ts';

const STORES = ['entries', 'sources', 'voxels', 'surfaces', 'palettes', 'settings'] as const;
type Store = typeof STORES[number];

/** Separate large immutable sources, geometry and meshes from small view metadata. */
export class HistoryDatabase {
  private opening?: Promise<IDBDatabase>;
  private database?: IDBDatabase;

  private open(): Promise<IDBDatabase> {
    if (this.opening) return this.opening;
    this.opening = new Promise<IDBDatabase>((resolve, reject) => {
      if (!globalThis.indexedDB) { reject(new Error('此浏览器无法使用本地历史记录。')); return; }
      const request = indexedDB.open('model2blueprint-history', 1);
      let rejected = false;
      request.onupgradeneeded = () => {
        for (const name of STORES) if (!request.result.objectStoreNames.contains(name)) request.result.createObjectStore(name, { keyPath: 'id' });
      };
      request.onerror = () => reject(request.error);
      request.onblocked = () => { rejected = true; reject(new Error('请关闭其他旧版页面后重试本地历史记录。')); };
      request.onsuccess = () => {
        if (rejected) { request.result.close(); return; }
        this.database = request.result;
        this.database.onversionchange = () => { this.close(); };
        resolve(this.database);
      };
    }).catch(reason => { this.opening = undefined; throw reason; });
    return this.opening;
  }

  private async transaction<T>(stores: Store[], mode: IDBTransactionMode,
    work: (transaction: IDBTransaction, done: (value: T) => void) => void): Promise<T> {
    const database = await this.open();
    return new Promise((resolve, reject) => {
      const transaction = database.transaction(stores, mode);
      let result: T;
      let failure: DOMException | null | undefined;
      transaction.oncomplete = () => resolve(result);
      transaction.onerror = event => { failure = (event.target as IDBRequest).error; };
      transaction.onabort = () => reject(transaction.error ?? failure ?? new Error('本地历史记录操作未完成。'));
      try { work(transaction, value => { result = value; }); }
      catch (reason) { transaction.abort(); reject(reason); }
    });
  }

  async bootstrap(): Promise<HistoryBootstrap> {
    return this.transaction(['entries', 'settings'], 'readonly', (transaction, done) => {
      const entries = transaction.objectStore('entries').getAll();
      const active = transaction.objectStore('settings').get('active');
      active.onsuccess = () => done({ entries: entries.result as HistoryEntry[], activeId: active.result?.value });
    });
  }

  async read(id: string): Promise<HistorySnapshot> {
    return this.transaction([...STORES], 'readonly', (transaction, done) => {
      const requests = ['entries', 'sources', 'palettes', 'voxels', 'surfaces'].map(name => transaction.objectStore(name).get(id));
      requests.at(-1)!.onsuccess = () => {
        const [entry, source, palette, result, surface] = requests.map(request => request.result);
        done({ entry, source: source?.value, palette: palette?.value, result: result?.value, surface: surface?.value });
      };
    });
  }

  async write(write: HistoryWrite): Promise<void> {
    const stores: Store[] = ['entries', 'palettes', 'surfaces', 'settings'];
    if (write.source) stores.push('sources');
    if (write.geometry) stores.push('voxels');
    return this.transaction(stores, 'readwrite', (transaction, done) => {
      const commit = () => {
        const id = write.entry.id;
        transaction.objectStore('entries').put(write.entry);
        transaction.objectStore('palettes').put({ id, value: write.palette });
        transaction.objectStore('surfaces').put({ id, value: write.surface });
        if (write.geometry) transaction.objectStore('voxels').put({ id, value: write.result });
        if (write.source) transaction.objectStore('sources').put({ id, value: write.source });
        transaction.objectStore('settings').put({ id: 'active', value: id }); done(undefined);
      };
      if (write.source) commit();
      else {
        const request = transaction.objectStore('entries').get(write.entry.id);
        request.onsuccess = () => { if (request.result) commit(); else transaction.abort(); };
      }
    });
  }

  async activate(id: string): Promise<void> {
    return this.transaction(['entries', 'settings'], 'readwrite', (transaction, done) => {
      const request = transaction.objectStore('entries').get(id);
      request.onsuccess = () => {
        if (!request.result) { transaction.abort(); return; }
        transaction.objectStore('settings').put({ id: 'active', value: id }); done(undefined);
      };
    });
  }

  async updateView(id: string, view: HistoryView, time: number): Promise<void> {
    return this.transaction(['entries'], 'readwrite', (transaction, done) => {
      const store = transaction.objectStore('entries'), request = store.get(id);
      request.onsuccess = () => {
        const entry = request.result as HistoryEntry | undefined;
        if (entry && time >= entry.viewUpdatedAt) store.put({ ...entry, view, viewUpdatedAt: time });
        done(undefined);
      };
    });
  }

  async remove(id: string): Promise<void> {
    return this.transaction([...STORES], 'readwrite', (transaction, done) => {
      for (const name of STORES) if (name !== 'settings') transaction.objectStore(name).delete(id);
      const active = transaction.objectStore('settings').get('active');
      active.onsuccess = () => {
        if (active.result?.value === id) transaction.objectStore('settings').delete('active');
        done(undefined);
      };
    });
  }

  close(): void {
    this.database?.close();
    void this.opening?.then(database => {
      database.close(); if (this.database === database) this.database = undefined;
    }, () => {});
    this.database = undefined; this.opening = undefined;
  }
}
