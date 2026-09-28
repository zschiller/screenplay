// PROTOTYPE (#984): a zustand store, shared with one line (idea 2).
import { create } from "zustand"
import { shareStore } from "proto984/share-store"

export const useSales = create((set) => ({
  contactOpen: false,
  plan: "Growth",
  seats: 5,
  open: (plan) => set({ contactOpen: true, plan }),
  close: () => set({ contactOpen: false }),
  setSeats: (seats) => set({ seats }),
}))

if (localStorage.getItem("proto984")?.includes('"store":true')) shareStore("sales", useSales)
