import type { Screen } from "../screen"

const PHONE = { width: 390, height: 760 }
const DESK = { width: 1200, height: 760 }

const screens: Screen[] = [
  { name: "today-not-found", description: "canvas not found", path: "/room-does-not-exist", viewport: DESK },
  { name: "opt-a", description: "A", path: "/explore-refused?o=A", viewport: DESK },
  { name: "opt-a-nolink", description: "A no link", path: "/explore-refused?o=A&link=0", viewport: DESK },
  { name: "opt-a-phone", description: "A phone", path: "/explore-refused?o=A", viewport: PHONE },
  { name: "opt-b", description: "B", path: "/explore-refused?o=B", viewport: DESK },
  { name: "opt-b-phone", description: "B phone", path: "/explore-refused?o=B", viewport: PHONE },
  { name: "opt-c", description: "C", path: "/explore-refused?o=C", viewport: DESK },
  { name: "opt-c-phone", description: "C phone", path: "/explore-refused?o=C", viewport: PHONE },
]
export default screens
