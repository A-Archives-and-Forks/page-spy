import {
  formatEntries,
  isString,
  isTypedArray,
  toStringTag,
} from '@huolala-tech/page-spy-base';
import { SpyNetwork } from '@huolala-tech/page-spy-types';

/** 判断当前值是否为 Lynx 运行时里的 FormData。 */
const isLynxFormData = (value: unknown): value is FormData => {
  return typeof FormData === 'function' && value instanceof FormData;
};

/** 判断当前值是否为 Lynx 运行时里的 Blob。 */
const isLynxBlob = (value: unknown): value is Blob => {
  return typeof Blob === 'function' && value instanceof Blob;
};

/** 将请求体格式化成调试面板可展示的文本/结构化值。 */
export async function getFormattedBody(body?: Document | BodyInit | null) {
  if (!body) {
    return null;
  }
  if (isLynxFormData(body)) {
    return formatEntries(body.entries());
  }
  if (isLynxBlob(body)) {
    return '[object Blob]';
  }
  if (isTypedArray(body)) {
    return '[object TypedArray]';
  }
  if (isString(body)) {
    return body;
  }
  return toStringTag(body);
}

/** 根据请求体推断 Content-Type，用于补齐调试面板里的请求头展示。 */
export function getContentType(data: Document | RequestInit['body']) {
  if (!data) return null;
  if (isLynxFormData(data)) {
    return 'multipart/form-data';
  }
  if (isLynxBlob(data)) {
    return data.type;
  }
  return 'text/plain;charset=UTF-8';
}

const CONTENT_TYPE_HEADER = 'Content-Type';
/** 如果调用方未设置 Content-Type，则根据 body 类型补一个展示用请求头。 */
export function addContentTypeHeader(
  headers: SpyNetwork.RequestInfo['requestHeader'],
  body?: Document | BodyInit | null,
) {
  if (!body) return headers;

  const bodyContentType = getContentType(body);
  if (!bodyContentType) return headers;

  const headerTuple = [CONTENT_TYPE_HEADER, bodyContentType] as [
    string,
    string,
  ];
  if (!headers) {
    return [headerTuple];
  }

  for (let i = 0; i < headers.length; i++) {
    const [key] = headers[i];
    if (key.toUpperCase() === CONTENT_TYPE_HEADER.toUpperCase()) {
      return headers;
    }
  }
  return [...headers, headerTuple];
}
