/** Runs async mutations in submission order, allowing later work after a failure. */
export const createSerializedMutationQueue = () => {
  let queue = Promise.resolve()

  return <T>(operation: () => Promise<T>): Promise<T> => {
    const result = queue.then(operation, operation)
    queue = result.then(
      () => undefined,
      () => undefined,
    )
    return result
  }
}
