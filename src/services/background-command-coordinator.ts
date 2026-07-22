export interface CoordinatedCommand<T> {
  itemUids: UID[]
  operationKey: string
  coalesce: boolean
  run: () => Promise<T>
}

const itemTails = new Map<UID, Promise<void>>()
const coalescedCommands = new Map<string, Promise<unknown>>()

function normalizedItemUids(itemUids: UID[]): UID[] {
  return [...new Set(itemUids)].sort()
}

function coalescingKey(operationKey: string, itemUids: UID[]): string {
  return JSON.stringify([operationKey, ...itemUids])
}

/** Coordinates commands that mutate one or more stable tree items. */
export function coordinateCommand<T>(
  command: CoordinatedCommand<T>,
): Promise<T> {
  const itemUids = normalizedItemUids(command.itemUids)
  const sharedKey = coalescingKey(command.operationKey, itemUids)

  if (command.coalesce) {
    const activeCommand = coalescedCommands.get(sharedKey)
    if (activeCommand) return activeCommand as Promise<T>
  }

  const priorCommands = itemUids.flatMap((uid) => {
    const tail = itemTails.get(uid)
    return tail ? [tail] : []
  })
  let operationPromise: Promise<T>
  if (priorCommands.length === 0) {
    try {
      operationPromise = Promise.resolve(command.run())
    } catch (error) {
      operationPromise = Promise.reject(error)
    }
  } else {
    operationPromise = Promise.all(priorCommands).then(command.run)
  }
  const settledTail = operationPromise.then(
    () => undefined,
    () => undefined,
  )

  for (const uid of itemUids) itemTails.set(uid, settledTail)
  if (command.coalesce) {
    coalescedCommands.set(sharedKey, operationPromise)
  }

  void settledTail.then(() => {
    for (const uid of itemUids) {
      if (itemTails.get(uid) === settledTail) itemTails.delete(uid)
    }
    if (coalescedCommands.get(sharedKey) === operationPromise) {
      coalescedCommands.delete(sharedKey)
    }
  })

  return operationPromise
}

export function resetCommandCoordinatorForTests(): void {
  itemTails.clear()
  coalescedCommands.clear()
}
