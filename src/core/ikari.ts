import { merge, Observable, Subject, Subscription, NEVER } from 'rxjs'
import { map, catchError } from 'rxjs/operators'
import { mapValues } from 'lodash'
import produce from 'immer'

import {
  EffectAction,
  ReducerAction,
  OriginalEffectActions,
  OriginalReducerActions,
  OriginalImmerReducerActions,
  OriginalDefineActions,
  TriggerActions,
  EffectActionFactories,
} from './types'
import { Ayanami } from './ayanami'
import { BasicState, getEffectActionFactories, getOriginalFunctions } from './utils'
import { logStateAction } from '../redux-devtools-extension'
import { ikariSymbol } from './symbols'

interface Config<State> {
  nameForLog: string
  defaultState: State
  effects: OriginalEffectActions<State>
  reducers: OriginalReducerActions<State>
  immerReducers: OriginalImmerReducerActions<State>
  defineActions: OriginalDefineActions
  effectActionFactories: EffectActionFactories
}

interface Action<State> {
  readonly effectAction?: EffectAction
  readonly reducerAction?: ReducerAction<State>
  readonly originalActionName: string
}

function catchRxError() {
  return catchError<any, any>((err) => {
    console.error(err)

    return NEVER
  })
}

export function combineWithIkari<S>(ayanami: Ayanami<S>): Ikari<S> {
  const ikari = Ikari.getFrom(ayanami)

  if (ikari) {
    return ikari
  } else {
    const { effects, reducers, immerReducers, defineActions } = getOriginalFunctions(ayanami)

    Object.assign(ayanami, mapValues(defineActions, ({ observable }) => observable))

    return Ikari.createAndBindAt(ayanami, {
      nameForLog: ayanami.constructor.name,
      defaultState: ayanami.defaultState,
      effects,
      reducers,
      immerReducers,
      defineActions,
      effectActionFactories: getEffectActionFactories(ayanami),
    })
  }
}

export function destroyIkariFrom<S>(ayanami: Ayanami<S>): void {
  const ikari = Ikari.getFrom(ayanami)

  if (ikari) {
    ikari.destroy()
    Reflect.deleteMetadata(ikariSymbol, ayanami)
  }
}

export class Ikari<State> {
  static createAndBindAt<S>(target: { defaultState: S }, config: Config<S>): Ikari<S> {
    const createdIkari = this.getFrom(target)

    if (createdIkari) {
      return createdIkari
    } else {
      const ikari = new Ikari(config)
      Reflect.defineMetadata(ikariSymbol, ikari, target)
      return ikari
    }
  }

  static getFrom<S>(target: { defaultState: S }): Ikari<S> | undefined {
    return Reflect.getMetadata(ikariSymbol, target)
  }

  state: BasicState<State>

  effectActionFactories: EffectActionFactories

  triggerActions: TriggerActions = {}

  subscription = new Subscription()

  constructor(private readonly config: Readonly<Config<State>>) {
    this.effectActionFactories = config.effectActionFactories
    this.state = new BasicState<State>(config.defaultState)

    const [effectActions$, effectActions] = setupEffectActions(
      this.config.effects,
      this.state.state$,
    )

    const [reducerActions$, reducerActions] = setupReducerActions(
      this.config.reducers,
      this.state.getState,
    )

    const [immerReducerActions$, immerReducerActions] = setupImmerReducerActions(
      this.config.immerReducers,
      this.state.getState,
    )

    this.triggerActions = {
      ...effectActions,
      ...reducerActions,
      ...immerReducerActions,
      ...mapValues(this.config.defineActions, ({ next }) => next),
    }

    this.subscription.add(
      effectActions$.subscribe((action) => {
        this.log(action)
        this.handleAction(action)
      }),
    )

    this.subscription.add(
      reducerActions$.subscribe((action) => {
        this.log(action)
        this.handleAction(action)
      }),
    )

    this.subscription.add(
      immerReducerActions$.subscribe((action) => {
        this.log(action)
        this.handleAction(action)
      }),
    )
  }

  destroy() {
    this.subscription.unsubscribe()
    this.triggerActions = {}
  }

  private log = ({ originalActionName, effectAction, reducerAction }: Action<State>) => {
    if (effectAction) {
      logStateAction(this.config.nameForLog, {
        params: effectAction.params,
        actionName: `${originalActionName}/👉${effectAction.ayanami.constructor.name}/️${
          effectAction.actionName
        }`,
      })
    }

    if (reducerAction) {
      logStateAction(this.config.nameForLog, {
        params: reducerAction.params,
        actionName: originalActionName,
        state: reducerAction.nextState,
      })
    }
  }

  private handleAction = ({ effectAction, reducerAction }: Action<State>) => {
    if (effectAction) {
      const { ayanami, actionName, params } = effectAction
      combineWithIkari(ayanami).triggerActions[actionName](params)
    }

    if (reducerAction) {
      this.state.setState(reducerAction.nextState)
    }
  }
}

function setupEffectActions<State>(
  effectActions: OriginalEffectActions<State>,
  state$: Observable<State>,
): [Observable<Action<State>>, TriggerActions] {
  const actions: TriggerActions = {}
  const effects: Observable<Action<State>>[] = []

  Object.keys(effectActions).forEach((actionName) => {
    const payload$ = new Subject<any>()
    actions[actionName] = (payload: any) => payload$.next(payload)

    const effect$: Observable<EffectAction> = effectActions[actionName](payload$, state$)
    effects.push(
      effect$.pipe(
        map(
          (effectAction): Action<State> => ({
            effectAction,
            originalActionName: actionName,
          }),
        ),
        catchRxError(),
      ),
    )
  })

  return [merge(...effects), actions]
}

function setupReducerActions<State>(
  reducerActions: OriginalReducerActions<State>,
  getState: () => State,
): [Observable<Action<State>>, TriggerActions] {
  const actions: TriggerActions = {}
  const reducers: Observable<Action<State>>[] = []

  Object.keys(reducerActions).forEach((actionName) => {
    const reducer$ = new Subject<Action<State>>()
    reducers.push(reducer$)

    const reducer = reducerActions[actionName]

    actions[actionName] = (params: any) => {
      const nextState = reducer(getState(), params)

      reducer$.next({
        reducerAction: { params, actionName, nextState },
        originalActionName: actionName,
      })
    }
  })

  return [merge(...reducers), actions]
}

function setupImmerReducerActions<State>(
  immerReducerActions: OriginalImmerReducerActions<State>,
  getState: () => State,
): [Observable<Action<State>>, TriggerActions] {
  const actions: TriggerActions = {}
  const immerReducers: Observable<Action<State>>[] = []

  Object.keys(immerReducerActions).forEach((actionName) => {
    const immerReducer$ = new Subject<Action<State>>()
    immerReducers.push(immerReducer$)

    const immerReducer = immerReducerActions[actionName]

    actions[actionName] = (params: any) => {
      const nextState = produce(getState(), (draft) => {
        immerReducer(draft, params)
      })

      immerReducer$.next({
        reducerAction: { params, actionName, nextState },
        originalActionName: actionName,
      })
    }
  })

  return [merge(...immerReducers), actions]
}
