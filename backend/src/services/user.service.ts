import { UserModel } from '../models/user.model.js';
import type { CreateUserInput, UpdateUserInput } from '../validators/user.validator.js';
import { ApiError } from '../utils/ApiError.js';

export const userService = {
  async list() {
    return UserModel.find().sort({ createdAt: -1 }).lean();
  },

  async getById(id: string) {
    const user = await UserModel.findById(id).lean();
    if (!user) throw ApiError.notFound('User not found');
    return user;
  },

  async create(input: CreateUserInput) {
    return UserModel.create(input);
  },

  async update(id: string, input: UpdateUserInput) {
    const user = await UserModel.findByIdAndUpdate(id, input, { new: true, runValidators: true }).lean();
    if (!user) throw ApiError.notFound('User not found');
    return user;
  },

  async remove(id: string) {
    const user = await UserModel.findByIdAndDelete(id).lean();
    if (!user) throw ApiError.notFound('User not found');
  },
};
