/** 読み込んだ ICC プロファイルを端末に1件だけ保存する */
export interface StoredProfile { name: string; bytes: Uint8Array }

const open = () => new Promise<IDBDatabase>((resolve, reject) => {
  const request = indexedDB.open('prtcorsim', 1);
  request.onupgradeneeded = () => request.result.createObjectStore('kv');
  request.onsuccess = () => resolve(request.result);
  request.onerror = () => reject(request.error);
});

export async function loadProfile(): Promise<StoredProfile | null> {
  try {
    const db = await open();
    return await new Promise(resolve => {
      const request = db.transaction('kv').objectStore('kv').get('icc');
      request.onsuccess = () => resolve(request.result ?? null);
      request.onerror = () => resolve(null);
    });
  } catch {
    return null;
  }
}

export async function saveProfile(profile: StoredProfile) {
  try {
    (await open()).transaction('kv', 'readwrite').objectStore('kv').put(profile, 'icc');
  } catch {
    // 保存できない環境では次回に読み込み直す
  }
}
