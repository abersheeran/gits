import { ProtocolError, UnsupportedFeatureError } from "./git-errors";
const MAX_FILTER_BLOB_LIMIT = 50 * 1024 * 1024;

type PackObjectFilter = {
  blobNone?: boolean;
  blobLimitBytes?: number;
};

export function parsePackObjectFilter(
  filterSpec: string | undefined
): PackObjectFilter | undefined {
  if (!filterSpec) {
    return undefined;
  }
  if (filterSpec === "blob:none") {
    return { blobNone: true };
  }
  if (filterSpec.startsWith("blob:limit=")) {
    const value = Number.parseInt(filterSpec.slice("blob:limit=".length), 10);
    if (!Number.isFinite(value) || Number.isNaN(value) || value < 0) {
      throw new ProtocolError("invalid blob:limit filter");
    }
    if (value > MAX_FILTER_BLOB_LIMIT) {
      throw new ProtocolError(`blob:limit exceeds maximum (${MAX_FILTER_BLOB_LIMIT})`);
    }
    return {
      blobLimitBytes: value
    };
  }
  throw new UnsupportedFeatureError("filter");
}
