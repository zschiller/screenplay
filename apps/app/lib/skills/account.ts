import "server-only"

import { fileStore } from "@/lib/files"
import { listFileIndex } from "@/lib/files/account-files"
import { kvAccountSkillStore } from "@/lib/files/account-store"
import { accountFileKeyPrefix } from "@/lib/files/paths"

import { createSavedSkills, type SavedSkill, type SavedSkills } from "./saved"

/**
 * **Account Skills** (#1558): Skills a chat saved to the person who sent its
 * turn, which follow them to every canvas. Every chat they send a turn in
 * lists and reads them; nobody else's turn ever does, and a turn nobody sent
 * (a Coordinator wake) gets none. Their entries keep a list of their own
 * beside the person's Account Files (`kvAccountSkillStore`); their bytes live
 * in the private file store under `account/<userId>/skills/`.
 */
export function accountSkills(userId: string): SavedSkills {
  return createSavedSkills({
    index: listFileIndex(kvAccountSkillStore(userId)),
    store: fileStore,
    keyPrefix: `${accountFileKeyPrefix(userId)}/skills`,
  })
}

/**
 * The Account Skills of the person who sent the turn, for its merged index:
 * none on a turn nobody sent, and a read that fails leaves the turn without
 * them rather than failing it.
 */
export async function loadAccountSkills(
  senderId: string | null
): Promise<SavedSkill[]> {
  if (!senderId) return []
  return accountSkills(senderId)
    .list()
    .catch(() => [])
}
