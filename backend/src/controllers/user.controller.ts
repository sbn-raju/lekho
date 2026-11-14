import type { Request, Response } from 'express';
import { userService } from '../services/user.service.js';
import { sendSuccess } from '../utils/apiResponse.js';

type IdParams = { id: string };

// Express 5 forwards rejected promises to the error handler, so no try/catch needed.
export const userController = {
  async list(_req: Request, res: Response) {
    sendSuccess(res, await userService.list());
  },

  async getById(req: Request<IdParams>, res: Response) {
    sendSuccess(res, await userService.getById(req.params.id));
  },

  async create(req: Request, res: Response) {
    sendSuccess(res, await userService.create(req.body), 'User created', 201);
  },

  async update(req: Request<IdParams>, res: Response) {
    sendSuccess(res, await userService.update(req.params.id, req.body), 'User updated');
  },

  async remove(req: Request<IdParams>, res: Response) {
    await userService.remove(req.params.id);
    res.status(204).send();
  },
};
