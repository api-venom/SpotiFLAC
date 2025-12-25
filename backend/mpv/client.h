/*
 * Placeholder for MPV client header
 * 
 * To enable MPV playback:
 * 1. Download MPV from: https://mpv.io/installation/
 * 2. Extract mpv-dev package
 * 3. Copy the 'client.h' header file to this location
 * 4. Copy 'mpv-2.dll' to project root or build output directory
 * 5. Rebuild the app with: wails build
 * 
 * The actual header should be obtained from:
 * - Windows: https://sourceforge.net/projects/mpv-player-windows/files/libmpv/
 * - Linux: Install libmpv-dev package
 * - macOS: brew install mpv
 * 
 * For full instructions, see: docs/MPV_SETUP.md
 */

#ifndef MPV_CLIENT_H_PLACEHOLDER
#define MPV_CLIENT_H_PLACEHOLDER

// This is just a placeholder to allow the project to compile without libmpv
// The real client.h from libmpv should replace this file

#ifdef __cplusplus
extern "C" {
#endif

typedef struct mpv_handle mpv_handle;

#define MPV_FORMAT_NONE 0
#define MPV_FORMAT_STRING 1
#define MPV_FORMAT_FLAG 3
#define MPV_FORMAT_INT64 4
#define MPV_FORMAT_DOUBLE 5

// Placeholder function declarations
// Replace this file with the real client.h from libmpv distribution

mpv_handle *mpv_create(void);
int mpv_initialize(mpv_handle *ctx);
void mpv_destroy(mpv_handle *ctx);
int mpv_set_option_string(mpv_handle *ctx, const char *name, const char *data);
int mpv_command(mpv_handle *ctx, const char **args);
int mpv_set_property(mpv_handle *ctx, const char *name, int format, void *data);
int mpv_get_property(mpv_handle *ctx, const char *name, int format, void *data);
void mpv_free(void *data);
const char *mpv_error_string(int error);

#ifdef __cplusplus
}
#endif

#endif /* MPV_CLIENT_H_PLACEHOLDER */
