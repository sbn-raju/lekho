import { Router } from 'express';
import { userController } from '../controllers/user.controller.js';
import { validate } from '../middlewares/validate.middleware.js';
import { createUserSchema, updateUserSchema, userIdParams } from '../validators/user.validator.js';

const router = Router();

router.get('/', userController.list);
router.post('/', validate({ body: createUserSchema }), userController.create);
router.get('/:id', validate({ params: userIdParams }), userController.getById);
router.patch('/:id', validate({ params: userIdParams, body: updateUserSchema }), userController.update);
router.delete('/:id', validate({ params: userIdParams }), userController.remove);

export default router;
