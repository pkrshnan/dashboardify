// ListService: checklists kept as notes in Lists/ (docs/lists.md). Each write edits only the
// lines it names, through ListStore, and refuses an etag older than the note.

import { addItems, clearDone, type ListItem, removeItem, updateItem } from "../../lists/list-note";
import {
  InvalidTitle,
  type ListDoc,
  ListNotFound,
  type ListStore,
  type ListSummary,
  StaleList,
} from "../../lists/list-store";
import { ApiError, invalidArgument } from "./errors";
import { requestedFields } from "./update-mask";

interface ItemInput {
  name?: string;
  text?: string;
  note?: string;
  done?: boolean;
  section?: string;
}

const ITEM_FIELDS = ["text", "note", "done", "section"];

export class ListsService {
  constructor(private readonly store: ListStore) {}

  listLists = async () => ({ lists: (await this.store.lists()).map(summaryView) });

  getList = async (request: { name: string }) => {
    const list = await this.store.get(slugFrom(request.name));
    if (!list) {
      throw notFound(request.name);
    }
    return listView(list);
  };

  createList = async (request: { list: { title?: string } }) => {
    try {
      return listView((await this.store.create(request.list.title ?? "")).list);
    } catch (error) {
      if (error instanceof InvalidTitle) {
        invalidArgument(error.message);
      }
      throw error;
    }
  };

  addListItems = async (request: {
    parent: string;
    texts: string[];
    etag?: string;
    section?: string;
  }) => {
    const slug = slugFrom(request.parent);
    const entries = request.texts.flatMap((text) => text.split(","));
    let added: ListItem[] = [];
    await this.edit(slug, request.etag, (text) => {
      const result = addItems(text, entries, request.section);
      added = result.items;
      return result.text;
    });
    return { items: added.map((item) => itemView(slug, item)) };
  };

  updateListItem = async (request: { item: ItemInput; updateMask?: string; etag?: string }) => {
    const { slug, id } = itemFrom(request.item.name ?? "");
    const change = itemChange(request.item, requestedFields(request, request.item, ITEM_FIELDS));
    let updated: ListItem | undefined;
    await this.edit(slug, request.etag, (text) => {
      const result = updateItem(text, id, change);
      updated = result?.item;
      return result?.text ?? null;
    });
    if (!updated) {
      throw notFound(request.item.name ?? "");
    }
    return itemView(slug, updated);
  };

  deleteListItem = async (request: { name: string; etag?: string }) => {
    const { slug, id } = itemFrom(request.name);
    let found = false;
    await this.edit(slug, request.etag, (text) => {
      const next = removeItem(text, id);
      found = next !== null;
      return next;
    });
    if (!found) {
      throw notFound(request.name);
    }
    return {};
  };

  clearDoneItems = async (request: { name: string; etag?: string }) =>
    listView(await this.edit(slugFrom(request.name), request.etag, (text) => clearDone(text).text));

  /** ListStore.edit with its errors as API errors. */
  private async edit(slug: string, etag: string | undefined, fn: (text: string) => string | null) {
    try {
      return await this.store.edit(slug, etag, fn);
    } catch (error) {
      if (error instanceof ListNotFound) {
        throw notFound(`lists/${slug}`);
      }
      if (error instanceof StaleList) {
        throw new ApiError(409, error.message, "aborted");
      }
      throw error;
    }
  }
}

/**
 * The fields to change. Protobuf JSON leaves out `done: false` and `section: ""`, so a masked
 * field that is missing means unticked, or before the first heading.
 */
function itemChange(item: ItemInput, fields: string[]) {
  return {
    ...(fields.includes("text") && { text: item.text ?? "" }),
    ...(fields.includes("note") && { note: item.note?.trim() || null }),
    ...(fields.includes("done") && { done: item.done === true }),
    ...(fields.includes("section") && { section: item.section?.trim() || null }),
  };
}

function slugFrom(name: string): string {
  const match = /^lists\/([a-z0-9-]+)$/.exec(name);
  if (!match?.[1]) {
    invalidArgument("name must be lists/{list}");
  }
  return match[1];
}

function itemFrom(name: string): { slug: string; id: string } {
  const match = /^lists\/([a-z0-9-]+)\/items\/([a-f0-9]+)$/.exec(name);
  if (!(match?.[1] && match[2])) {
    invalidArgument("name must be lists/{list}/items/{item}");
  }
  return { slug: match[1], id: match[2] };
}

function notFound(name: string): ApiError {
  return new ApiError(404, `${name} not found`, "not_found");
}

function summaryView(list: ListSummary) {
  return {
    name: `lists/${list.slug}`,
    title: list.title,
    path: list.path,
    openCount: list.openCount,
  };
}

function listView(list: ListDoc) {
  return {
    ...summaryView(list),
    sections: list.sections.map((section) => ({
      title: section.title ?? "",
      items: section.items.map((item) => itemView(list.slug, item)),
    })),
    etag: list.etag,
  };
}

function itemView(slug: string, item: ListItem) {
  return {
    name: `lists/${slug}/items/${item.id}`,
    text: item.text,
    note: item.note ?? "",
    done: item.done,
    section: item.section ?? "",
  };
}
