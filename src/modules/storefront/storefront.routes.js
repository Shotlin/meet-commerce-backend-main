import { AllocationRepository } from "../allocation/allocation.repository.js";
import { AllocationService } from "../allocation/allocation.service.js";
import { success, error } from "../../utils/apiResponse.js";

/**
 * Public, location-first storefront bootstrap.
 *
 * This endpoint deliberately does not create a user, address, allocation, or
 * database record. It converts a verified device location into a short-lived
 * signed storefront token that constrains public catalogue reads to the
 * matching store until the customer signs in.
 */
export default async function storefrontRoutes(fastify) {
  const allocationService = new AllocationService(new AllocationRepository());

  fastify.post(
    "/resolve-location",
    {
      schema: {
        body: {
          type: "object",
          required: ["lat", "lng"],
          properties: {
            lat: { type: "number", minimum: -90, maximum: 90 },
            lng: { type: "number", minimum: -180, maximum: 180 },
            // Reverse geocoders occasionally omit postal_code even when the
            // device location is precise. Coordinates still let radius-based
            // stores resolve safely; pincode-only stores remain excluded.
            pincode: { type: "string", minLength: 3, maxLength: 10 },
          },
          additionalProperties: false,
        },
      },
    },
    async (request, reply) => {
      const result = await allocationService.resolveForLocation(request.body);
      if (!result.success) {
        return reply.code(400).send(error(result.message, result.code));
      }

      const shops = result.data.shops;
      if (shops.length === 0) {
        return reply.send(
          success(
            { serviceable: false, shops: [] },
            "Delivery is not available at this location",
          ),
        );
      }
      const primary = shops.find((shop) => shop.is_primary) || shops[0];
      const storefrontToken = fastify.jwt.sign(
        { scope: "guest-storefront", shopIds: [primary.shop_id] },
        { expiresIn: "30d" },
      );
      return reply.send(
        success(
          {
            serviceable: true,
            shop: { id: primary.shop_id, name: primary.name },
            storefrontToken,
          },
          "Storefront location resolved",
        ),
      );
    },
  );
}
