import { ok, withAuth } from "@/lib/api";
import { categoryTree } from "@/lib/services/import";

/** Дерево папок номенклатуры. */
export const GET = withAuth(async () => ok(await categoryTree()), ["catalog.read"]);
