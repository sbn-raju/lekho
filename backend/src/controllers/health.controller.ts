import type { Request, Response } from 'express';
import mongoose from 'mongoose';

const DB_STATES: Record<number, string> = { 0: 'disconnected', 1: 'connected', 2: 'connecting', 3: 'disconnecting' };

export const healthController = {
  check(_req: Request, res: Response) {
    res.json({
      success: true,
      status: 'ok',
      uptime: process.uptime(),
      database: DB_STATES[mongoose.connection.readyState] ?? 'unknown',
      timestamp: new Date().toISOString(),
    });
  },
};
