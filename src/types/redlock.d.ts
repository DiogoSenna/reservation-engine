declare module 'redlock' {
  export interface Lock {
    unlock(): Promise<void>
  }

  export interface RedlockOptions {
    retryCount?: number
    retryDelay?: number
    retryJitter?: number
  }

  export default class Redlock {
    constructor(clients: object[], options?: RedlockOptions)
    lock(resource: string, ttl: number): Promise<Lock>
  }
}
