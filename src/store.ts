import { JSONArray, JSONObject, JSONPrimitive, JSONValue } from "./json-types";

export type Permission = "r" | "w" | "rw" | "none";

export type StoreResult = Store | JSONPrimitive | undefined;

export type StoreValue =
  | JSONObject
  | JSONArray
  | StoreResult
  | (() => StoreResult);

export interface IStore {
  defaultPolicy: Permission;
  allowedToRead(key: string): boolean;
  allowedToWrite(key: string): boolean;
  read(path: string): StoreResult;
  write(path: string, value: StoreValue): StoreValue;
  writeEntries(entries: JSONObject): void;
  entries(): JSONObject;
}

const permissionsWeakMap = new WeakMap<Function, {[key in string]: Permission}>()

export function Restrict(providedPermission?: Permission) {
  return (target: Store, key: string) => {
    const permission = providedPermission ?? target.defaultPolicy
    const targetPermissions = permissionsWeakMap.get(target.constructor)

    if (!targetPermissions) {
      permissionsWeakMap.set(target.constructor, {
        [key]: permission
      })
    } else {
      targetPermissions[key] = permission
    }
  };
}

export class Store implements IStore {
  defaultPolicy: Permission = "rw";

  private getPermission(key: string) {
    let current: Store = this
    let permission: Permission | undefined = undefined

    // If no permission policy is available, use the permission policy of the closest parent that
    // has one.
    while (true) {
      const permissions = permissionsWeakMap.get(current.constructor)
      permission = permissions?.[key]

      if (permission) {
        break
      }

      current = Object.getPrototypeOf(current);

      if (!current) {
        break
      }
    }

    return permission || this.defaultPolicy
  }

  allowedToRead(key: string): boolean {
    const permission = this.getPermission(key)

    const allowedToRead = permission === "r" || permission === "rw"

    return allowedToRead
  }

  allowedToWrite(key: string): boolean {
    const permission = this.getPermission(key)

    const allowedToWrite = permission === "w" || permission === "rw"

    return allowedToWrite
  }

  assertPropertyValidity(key: string) {
    const storeProperties = Object.keys(new Store())

    if (storeProperties.includes(key)) {
      throw new Error(`Cannot access reserved property ${key}.`)
    }
  }

  read(path: string): StoreResult {
    const keys = path.split(":")
    const key = keys[0] as keyof this
    const isLastKey = keys.length === 1

    this.assertPropertyValidity(String(key))

    if (isLastKey) {
      if (!this.allowedToRead(path)) {
        throw new Error(`Cannot read ${path}`)
      }

      const entry = this[key]

      if (entry instanceof Function) {
        return entry() as StoreResult
      } else {
        return entry as StoreResult
      }
    } else {
      const remainingKeys = keys.slice(1)
      const remainingPath = remainingKeys.join(":")

      const entry = this[key]
      let store: Store | null = null

      if (entry instanceof Function) {
        store = entry()
      } else if (entry instanceof Store) {
        store = entry as Store
      }

      if (!(store instanceof Store)) {
        throw new Error(`Entry ${String(key)} is not a store.`)
      }

      return store.read(remainingPath)
    }
  }

  write(path: string, value: StoreValue): StoreValue {
    const keys = path.split(":")
    const key = keys[0] as keyof this
    const isLastKey = keys.length === 1

    this.assertPropertyValidity(String(key))

    if (isLastKey) {
      if (!this.allowedToWrite(path)) {
        throw new Error(`Cannot write ${path}`)
      }

      const valueIsObject = ((value: StoreValue): value is JSONObject => {
        return value?.constructor === Object
      })(value)

      if (valueIsObject) {
        const store = new Store()
        store.writeEntries(value)
        ;(this[key] as StoreValue) = store
      } else {
        ;(this[key] as StoreValue) = value
      }
    } else {
      const remainingKeys = keys.slice(1)
      const remainingPath = remainingKeys.join(":")

      let entry = this[key]

      if (!entry) {
        const store = new Store()
        store.defaultPolicy = this.defaultPolicy
        ;(entry as Store) = store
        ;(this[key] as Store) = entry as Store
      }

      if (!(entry instanceof Store)) {
        throw new Error(`Entry ${String(key)} is not a store.`)
      }

      return entry.write(remainingPath, value)
    }
  }

  writeEntries(entries: JSONObject): void {
    for (const [key, value] of Object.entries(entries)) {
      this.write(key, value)
    }
  }

  entries(): JSONObject {
    const customProperties = this.customProperties()
      .filter(property => this.allowedToRead(property))

    const entries = customProperties.map(property => {
      const value = this.read(property)

      let formattedValue: JSONValue

      if (value instanceof Store) {
        formattedValue = value.entries()
      } else {
        formattedValue = value || null
      }

      return [
        property,
        formattedValue,
      ]
    })

    return Object.fromEntries(entries)
  }

  /**
   * Returns only the properties managed by the store, excluding all meta-properties such as
   * defaultPolicy.
   */
  customProperties(): string[] {
    const storeProperties = Object.keys(new Store())
    const customProperties = Object.keys(this).filter(property => {
      const comesFromPrototype = storeProperties.includes(property)

      return !comesFromPrototype
    })

    return customProperties
  }
}
