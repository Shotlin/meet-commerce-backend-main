/**
 * Rider Shifts & Deliveries Schemas
 * Source of truth: Blueprint §06.8, Phase 9
 *
 * @module modules/deliveries/deliveries.schema
 */

export const CreateRiderSchema = {
  type: 'object',
  required: ['user_id'],
  properties: {
    user_id: { type: 'string' },
    vehicle_type: { type: 'string', default: 'BIKE' },
    license_number: { type: 'string' },
  },
  additionalProperties: false,
}

export const UpdateShiftSchema = {
  type: 'object',
  required: ['status'],
  properties: {
    status: { type: 'string', enum: ['ON_DUTY', 'BREAK', 'OFF_DUTY'] },
  },
  additionalProperties: false,
}

export const AssignDeliverySchema = {
  type: 'object',
  required: ['order_id', 'rider_id'],
  properties: {
    order_id: { type: 'string' },
    rider_id: { type: 'string' },
    notes: { type: 'string' },
  },
  additionalProperties: false,
}

export const UpdateDeliveryStatusSchema = {
  type: 'object',
  required: ['status'],
  properties: {
    status: { type: 'string', enum: ['ASSIGNED', 'PICKED_UP', 'IN_TRANSIT', 'DELIVERED', 'FAILED', 'CANCELLED'] },
    notes: { type: 'string' },
  },
  additionalProperties: false,
}
