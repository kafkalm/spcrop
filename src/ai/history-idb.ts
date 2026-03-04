import type { GalleryItem, PersistedAiState, TaskRecord } from "./types";

const DB_NAME = "spcrop.ai.history.v1";
const DB_VERSION = 1;
const TASK_STORE = "tasks";
const GALLERY_STORE = "gallery";
const HANDLE_STORE = "handles";
const MAX_TASK_HISTORY = 500;

type DbTarget = IDBDatabase | IDBTransaction | IDBObjectStore;

function getStore(target: DbTarget, name: string): IDBObjectStore {
  if (target instanceof IDBDatabase) {
    return target.transaction(name, "readwrite").objectStore(name);
  }
  if (target instanceof IDBTransaction) {
    return target.objectStore(name);
  }
  return target;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(TASK_STORE)) {
        db.createObjectStore(TASK_STORE, { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains(GALLERY_STORE)) {
        db.createObjectStore(GALLERY_STORE, { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains(HANDLE_STORE)) {
        db.createObjectStore(HANDLE_STORE);
      }
    };
    request.onerror = () => {
      reject(request.error ?? new Error("Failed to open IndexedDB"));
    };
    request.onsuccess = () => {
      resolve(request.result);
    };
  });
}

function idbRequest<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("IndexedDB request failed"));
  });
}

export function trimTaskHistory(tasks: TaskRecord[], max = MAX_TASK_HISTORY): TaskRecord[] {
  const normalized = [...tasks].sort((a, b) => b.createdAt - a.createdAt);
  if (normalized.length <= max) {
    return normalized;
  }
  return normalized.slice(0, max);
}

export async function saveAiHistory(state: PersistedAiState): Promise<void> {
  const db = await openDb();
  try {
    const tx = db.transaction([TASK_STORE, GALLERY_STORE], "readwrite");
    const taskStore = getStore(tx, TASK_STORE);
    const galleryStore = getStore(tx, GALLERY_STORE);

    taskStore.clear();
    galleryStore.clear();

    for (const task of trimTaskHistory(state.tasks)) {
      taskStore.put(task);
    }

    const validTaskIds = new Set(trimTaskHistory(state.tasks).map((t) => t.id));
    for (const item of state.gallery) {
      if (validTaskIds.has(item.taskId)) {
        galleryStore.put(item);
      }
    }

    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error("Failed to save AI history"));
      tx.onabort = () => reject(tx.error ?? new Error("AI history transaction aborted"));
    });
  } finally {
    db.close();
  }
}

export async function loadAiHistory(): Promise<PersistedAiState> {
  const db = await openDb();
  try {
    const tx = db.transaction([TASK_STORE, GALLERY_STORE], "readonly");
    const tasks = (await idbRequest(getStore(tx, TASK_STORE).getAll())) as TaskRecord[];
    const gallery = (await idbRequest(getStore(tx, GALLERY_STORE).getAll())) as GalleryItem[];

    return {
      tasks: trimTaskHistory(tasks),
      gallery: gallery
        .filter((item) => tasks.some((task) => task.id === item.taskId))
        .sort((a, b) => b.createdAt - a.createdAt),
    };
  } finally {
    db.close();
  }
}

const OUTPUT_DIR_KEY = "output-directory";

export async function saveOutputDirectoryHandle(handle: FileSystemDirectoryHandle): Promise<void> {
  const db = await openDb();
  try {
    const tx = db.transaction(HANDLE_STORE, "readwrite");
    getStore(tx, HANDLE_STORE).put(handle, OUTPUT_DIR_KEY);
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error("Failed to save output directory handle"));
      tx.onabort = () => reject(tx.error ?? new Error("Save handle transaction aborted"));
    });
  } finally {
    db.close();
  }
}

export async function loadOutputDirectoryHandle(): Promise<FileSystemDirectoryHandle | null> {
  const db = await openDb();
  try {
    const tx = db.transaction(HANDLE_STORE, "readonly");
    const handle = (await idbRequest(getStore(tx, HANDLE_STORE).get(OUTPUT_DIR_KEY))) as
      | FileSystemDirectoryHandle
      | undefined;
    return handle ?? null;
  } finally {
    db.close();
  }
}
