import { ROOT_ROUTE, type RouteLocation } from "@ui/routes/types"
import { type Accessor, createMemo, createSignal } from "solid-js"

export type NavigationStore = {
  stack: Accessor<RouteLocation[]>
  current: Accessor<RouteLocation>
  depth: Accessor<number>
  push(page: RouteLocation): void
  pop(): void
  replace(page: RouteLocation): void
  reset(pages?: RouteLocation[]): void
}

export function createNavigationStore(): NavigationStore {
  const [stack, setStack] = createSignal<RouteLocation[]>([ROOT_ROUTE])

  const findResourceIndex = (pages: RouteLocation[], name: string) =>
    pages.findIndex((route) => route.type === "resource" && route.resourceName === name)

  const push = (page: RouteLocation) => {
    setStack((prev) => {
      if (page.type !== "resource") {
        return [...prev, page]
      }
      const index = findResourceIndex(prev, page.resourceName)
      if (index === -1) {
        return [...prev, page]
      }
      const existing = prev[index]
      const next = [...prev]
      next.splice(index, 1)
      next.push(existing)
      return next
    })
  }

  const pop = () => {
    setStack((prev) => {
      if (prev.length <= 1) {
        return prev
      }
      return prev.slice(0, -1)
    })
  }

  const replace = (page: RouteLocation) => {
    setStack((prev) => {
      if (!prev.length) {
        return [page]
      }
      if (page.type !== "resource") {
        return [...prev.slice(0, -1), page]
      }
      const index = findResourceIndex(prev, page.resourceName)
      if (index === -1) {
        return [...prev.slice(0, -1), page]
      }
      if (index === prev.length - 1) {
        return prev
      }
      const next = [...prev]
      const existing = next[index]
      next.splice(index, 1)
      next[next.length - 1] = existing
      return next
    })
  }

  const reset = (pages?: RouteLocation[]) => {
    setStack(() => {
      if (pages?.length) {
        return [...pages]
      }
      return [ROOT_ROUTE]
    })
  }

  const stackAccessor: Accessor<RouteLocation[]> = stack
  const current = createMemo<RouteLocation>(() => {
    const pages = stackAccessor()
    return pages[pages.length - 1] ?? ROOT_ROUTE
  })
  const depth = createMemo(() => stackAccessor().length)

  return {
    stack: stackAccessor,
    current,
    depth,
    push,
    pop,
    replace,
    reset,
  }
}
