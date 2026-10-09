/**
 * Baileys auth state persisted in Postgres (table whatsapp_auth_state).
 *
 * `useMultiFileAuthState` writes to the container's disk, which is wiped on
 * every redeploy and would force a fresh QR scan each time. Same contract,
 * different storage.
 */
export async function useDbAuthState(repo, baileys) {
  const { initAuthCreds, BufferJSON, proto } = baileys

  const read = async (id) => {
    const raw = await repo.authGet(id)
    return raw ? JSON.parse(raw, BufferJSON.reviver) : null
  }
  const write = (id, value) => repo.authSet(id, JSON.stringify(value, BufferJSON.replacer))

  const creds = (await read('creds')) || initAuthCreds()

  return {
    state: {
      creds,
      keys: {
        get: async (type, ids) => {
          const data = {}
          await Promise.all(
            ids.map(async (id) => {
              let value = await read(`${type}-${id}`)
              if (type === 'app-state-sync-key' && value) {
                value = proto.Message.AppStateSyncKeyData.fromObject(value)
              }
              data[id] = value
            })
          )
          return data
        },
        set: async (data) => {
          const tasks = []
          for (const category of Object.keys(data)) {
            for (const id of Object.keys(data[category])) {
              const value = data[category][id]
              const key = `${category}-${id}`
              tasks.push(value ? write(key, value) : repo.authDelete(key))
            }
          }
          await Promise.all(tasks)
        },
      },
    },
    saveCreds: () => write('creds', creds),
  }
}
