import { z } from 'zod';
import { DataSourceTypeSchema } from './enums';

export const DataSourceSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1).max(255),
  type: DataSourceTypeSchema,
  url: z.string().url().nullable().optional(),
  lastUpdated: z.date().nullable().optional(),
  createdAt: z.date(),
  updatedAt: z.date(),
});
export type DataSource = z.infer<typeof DataSourceSchema>;

export const CreateDataSourceSchema = DataSourceSchema.omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type CreateDataSource = z.infer<typeof CreateDataSourceSchema>;
