import { Ayanami, Reducer, getAllActionsForTest } from '../../src'

interface CountState {
  count: number
}

describe('Ayanami specs:', () => {
  it('getState', () => {
    class Count extends Ayanami<CountState> {
      defaultState = { count: 0 }

      @Reducer()
      setCount(count: number): Partial<CountState> {
        return { count }
      }
    }

    const actions = getAllActionsForTest(Count)

    expect(Count.getState()).toEqual({ count: 0 })
    actions.setCount(10)
    expect(Count.getState()).toEqual({ count: 10 })
  })

  it('getState$', () => {
    class Count extends Ayanami<CountState> {
      defaultState = { count: 0 }

      @Reducer()
      setCount(count: number) {
        return { count }
      }
    }

    const actions = getAllActionsForTest(Count)
    const count$ = Count.getState$()

    const callback = jest.fn()

    count$.subscribe(callback)

    actions.setCount(44)

    expect(callback.mock.calls.length).toBe(2)
    expect(callback.mock.calls[0][0]).toEqual({ count: 0 })
    expect(callback.mock.calls[1][0]).toEqual({ count: 44 })
  })
})