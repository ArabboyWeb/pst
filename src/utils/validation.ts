import { z } from 'zod';

/**
 * Schemas used to validate parsed manifest contents.
 * Be lenient: missing fields are acceptable; we only validate that the
 * structures we *do* read are well-formed.
 */

export const PackageJsonSchema = z
  .object({
    name: z.string().optional(),
    version: z.string().optional(),
    description: z.string().optional(),
    private: z.boolean().optional(),
    type: z.string().optional(),
    engines: z
      .object({
        node: z.string().optional(),
        npm: z.string().optional(),
      })
      .passthrough()
      .optional(),
    scripts: z.record(z.string()).optional(),
    dependencies: z.record(z.string()).optional(),
    devDependencies: z.record(z.string()).optional(),
    peerDependencies: z.record(z.string()).optional(),
    workspaces: z
      .union([z.array(z.string()), z.object({ packages: z.array(z.string()) })])
      .optional(),
    main: z.string().optional(),
    module: z.string().optional(),
    bin: z
      .union([z.string(), z.record(z.string())])
      .optional(),
  })
  .passthrough();

export type PackageJson = z.infer<typeof PackageJsonSchema>;

export const GoModSchema = z
  .object({
    module: z.string().optional(),
    go: z.string().optional(),
    toolchain: z.string().optional(),
    require: z
      .array(z.object({ path: z.string(), version: z.string() }))
      .optional(),
  })
  .passthrough();

export type GoMod = z.infer<typeof GoModSchema>;

export const PyprojectSchema = z
  .object({
    project: z
      .object({
        name: z.string().optional(),
        version: z.string().optional(),
        'requires-python': z.string().optional(),
        dependencies: z.array(z.string()).optional(),
        scripts: z.record(z.string()).optional(),
      })
      .passthrough()
      .optional(),
    'build-system': z
      .object({
        'requires': z.array(z.string()).optional(),
        'build-backend': z.string().optional(),
      })
      .passthrough()
      .optional(),
    tool: z
      .object({
        poetry: z
          .object({
            name: z.string().optional(),
            version: z.string().optional(),
            dependencies: z.record(z.unknown()).optional(),
            'dev-dependencies': z.record(z.unknown()).optional(),
          })
          .passthrough()
          .optional(),
        uv: z
          .object({
            'dev-dependencies': z.array(z.string()).optional(),
          })
          .passthrough()
          .optional(),
      })
      .passthrough()
      .optional(),
  })
  .passthrough();

export type Pyproject = z.infer<typeof PyprojectSchema>;
