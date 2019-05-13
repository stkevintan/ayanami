import { InjectableFactory } from '@asuka/di'

import { ConstructorOf } from '../types'
import { Scope } from './type'

type ScopeMap<K, V> = Map<K, V>

type Instance = any

type Key = ConstructorOf<Instance>

const map: Map<Key, ScopeMap<Scope, Instance>> = new Map()

export function createNewInstance<T>(constructor: ConstructorOf<T>): T {
  return InjectableFactory.injector.resolveAndCreateChild([constructor]).get(constructor)
}

export function createOrGetInstanceInScope<T>(constructor: ConstructorOf<T>, scope: Scope): T {
  const instanceAtScope = getInstanceFrom(constructor, scope)

  return instanceAtScope ? instanceAtScope : createInstanceInScope(constructor, scope)
}

function createInstanceInScope<T>(constructor: ConstructorOf<T>, scope: Scope): T {
  const newInstance = createNewInstance(constructor)

  setInstanceInScope(constructor, scope, newInstance)

  return newInstance
}

function setInstanceInScope<T>(constructor: ConstructorOf<T>, scope: Scope, newInstance: Instance) {
  const scopeMap: ScopeMap<Scope, Instance> = map.get(constructor) || new Map()

  scopeMap.set(scope, newInstance)
  map.set(constructor, scopeMap)
}

function getInstanceFrom<T>(constructor: ConstructorOf<T>, scope: Scope): T | undefined {
  const scopeMap = map.get(constructor)

  return scopeMap && scopeMap.get(scope)
}
