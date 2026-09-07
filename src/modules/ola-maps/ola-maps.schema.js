/**
 * Ola Maps JSON Schemas — Beta/test module
 */

export const styleUrlSchema = {
  tags: ['Maps'],
  summary: 'Get the Ola Maps vector style URL (Beta/test module)',
  security: [{ bearerAuth: [] }],
}

export const styleJsonSchema = {
  tags: ['Maps'],
  summary: 'Self-contained, key-stitched Ola Maps style document (public, no app auth)',
  querystring: {
    type: 'object',
    properties: {
      style: { type: 'string', minLength: 1, maxLength: 100 },
    },
  },
}

export const staticMapUrlSchema = {
  tags: ['Maps'],
  summary: 'Get a key-embedded Ola Maps static (raster) image URL (Beta/test module)',
  security: [{ bearerAuth: [] }],
  querystring: {
    type: 'object',
    required: ['lat', 'lng'],
    properties: {
      lat: { type: 'number', minimum: -90, maximum: 90 },
      lng: { type: 'number', minimum: -180, maximum: 180 },
      zoom: { type: 'number', minimum: 0, maximum: 20, default: 16 },
      width: { type: 'integer', minimum: 64, maximum: 1280, default: 600 },
      height: { type: 'integer', minimum: 64, maximum: 1280, default: 400 },
      marker: { type: 'boolean', default: true },
    },
  },
}

export const geocodeSchema = {
  tags: ['Maps'],
  summary: 'Forward geocode via Ola Maps (Beta/test module)',
  security: [{ bearerAuth: [] }],
  querystring: {
    type: 'object',
    required: ['address'],
    properties: {
      address: { type: 'string', minLength: 1, maxLength: 500 },
    },
  },
}

export const reverseGeocodeSchema = {
  tags: ['Maps'],
  summary: 'Reverse geocode via Ola Maps (Beta/test module)',
  security: [{ bearerAuth: [] }],
  querystring: {
    type: 'object',
    required: ['lat', 'lng'],
    properties: {
      lat: { type: 'number', minimum: -90, maximum: 90 },
      lng: { type: 'number', minimum: -180, maximum: 180 },
    },
  },
}

export const directionsSchema = {
  tags: ['Maps'],
  summary: 'Driving route + distance/duration via Ola Maps (Beta/test module)',
  security: [{ bearerAuth: [] }],
  querystring: {
    type: 'object',
    required: ['originLat', 'originLng', 'destLat', 'destLng'],
    properties: {
      originLat: { type: 'number', minimum: -90, maximum: 90 },
      originLng: { type: 'number', minimum: -180, maximum: 180 },
      destLat: { type: 'number', minimum: -90, maximum: 90 },
      destLng: { type: 'number', minimum: -180, maximum: 180 },
    },
  },
}
