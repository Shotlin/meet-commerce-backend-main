import { AdminBannersService } from '../admin/banners/banners.service.js'
import { success } from '../../utils/apiResponse.js'

const svc = new AdminBannersService()

export default async function bannerRoutes(fastify) {
  fastify.get('/', async (request, reply) => {
    const { type } = request.query
    const banners = await svc.getActiveForStoreStatus(type)
    return success(banners, 'Active banners fetched')
  })
}
