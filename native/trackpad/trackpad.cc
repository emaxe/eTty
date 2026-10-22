// Сырые касания тачпада macOS (приватный MultitouchSupport.framework, грузится через dlopen).
// Электрон не отдаёт мультитач ни в DOM, ни в main-процессе, а тап двумя пальцами в DOM
// неотличим от клика. Аддон только пробрасывает кадры касаний в JS; распознавание жестов — в
// src/shared/tap-gesture-recognizer.js.
//
// API: start(cb) -> boolean, stop(). cb(timeSeconds, [[id, x, y], ...]) — x/y нормализованы 0..1.
// Кадр шлётся при смене числа касаний или заметном сдвиге; кадр «0 касаний» — один раз.

#include <napi.h>
#include <CoreFoundation/CoreFoundation.h>
#include <dlfcn.h>

#include <cmath>
#include <mutex>
#include <vector>

namespace {

struct MTPoint { float x, y; };
struct MTReadout { MTPoint pos, vel; };
// Раскладка из открытых реверс-описаний MultitouchSupport; sizeof должен быть 96.
struct MTFinger {
  int frame;
  double timestamp;
  int identifier;
  int state;
  int foo3;
  int foo4;
  MTReadout normalized;
  float size;
  int zero1;
  float angle;
  float majorAxis;
  float minorAxis;
  MTReadout mm;
  int zero2[2];
  float unk2;
};
static_assert(sizeof(MTFinger) == 96, "unexpected MTFinger layout");

typedef void* MTDeviceRef;
typedef int (*MTContactCallback)(MTDeviceRef, MTFinger*, int, double, int);
typedef CFArrayRef (*MTDeviceCreateListFn)(void);
typedef void (*MTRegisterFn)(MTDeviceRef, MTContactCallback);
typedef void (*MTUnregisterFn)(MTDeviceRef, MTContactCallback);
typedef int (*MTDeviceStartFn)(MTDeviceRef, int);
typedef void (*MTDeviceStopFn)(MTDeviceRef);

constexpr int kStateTouching = 4;
constexpr float kMoveEps = 0.003f;

struct Contact { int id; float x, y; };
struct Frame { double t; std::vector<Contact> contacts; };

std::mutex g_mutex;
bool g_active = false;
Napi::ThreadSafeFunction g_tsfn;
CFArrayRef g_devices = nullptr;
std::vector<Contact> g_last;

void* g_lib = nullptr;
MTDeviceCreateListFn MTDeviceCreateList = nullptr;
MTRegisterFn MTRegisterContactFrameCallback = nullptr;
MTUnregisterFn MTUnregisterContactFrameCallback = nullptr;
MTDeviceStartFn MTDeviceStart = nullptr;
MTDeviceStopFn MTDeviceStop = nullptr;

bool LoadFramework() {
  if (g_lib) return true;
  g_lib = dlopen("/System/Library/PrivateFrameworks/MultitouchSupport.framework/MultitouchSupport", RTLD_LAZY);
  if (!g_lib) return false;
  MTDeviceCreateList = (MTDeviceCreateListFn)dlsym(g_lib, "MTDeviceCreateList");
  MTRegisterContactFrameCallback = (MTRegisterFn)dlsym(g_lib, "MTRegisterContactFrameCallback");
  MTUnregisterContactFrameCallback = (MTUnregisterFn)dlsym(g_lib, "MTUnregisterContactFrameCallback");
  MTDeviceStart = (MTDeviceStartFn)dlsym(g_lib, "MTDeviceStart");
  MTDeviceStop = (MTDeviceStopFn)dlsym(g_lib, "MTDeviceStop");
  return MTDeviceCreateList && MTRegisterContactFrameCallback && MTUnregisterContactFrameCallback &&
         MTDeviceStart && MTDeviceStop;
}

bool Changed(const std::vector<Contact>& now) {
  if (now.size() != g_last.size()) return true;
  for (size_t i = 0; i < now.size(); i++) {
    if (now[i].id != g_last[i].id) return true;
    if (std::fabs(now[i].x - g_last[i].x) > kMoveEps || std::fabs(now[i].y - g_last[i].y) > kMoveEps) return true;
  }
  return false;
}

// Вызывается MultitouchSupport из его собственного потока.
int OnFrame(MTDeviceRef, MTFinger* data, int count, double timestamp, int) {
  std::vector<Contact> contacts;
  for (int i = 0; i < count; i++) {
    if (data[i].state != kStateTouching) continue;
    contacts.push_back({data[i].identifier, data[i].normalized.pos.x, data[i].normalized.pos.y});
  }

  std::lock_guard<std::mutex> lock(g_mutex);
  if (!g_active || !Changed(contacts)) return 0;
  g_last = contacts;

  auto* frame = new Frame{timestamp, std::move(contacts)};
  napi_status status = g_tsfn.NonBlockingCall(frame, [](Napi::Env env, Napi::Function cb, Frame* f) {
    Napi::Array arr = Napi::Array::New(env, f->contacts.size());
    for (size_t i = 0; i < f->contacts.size(); i++) {
      Napi::Array c = Napi::Array::New(env, 3);
      c.Set(0u, Napi::Number::New(env, f->contacts[i].id));
      c.Set(1u, Napi::Number::New(env, f->contacts[i].x));
      c.Set(2u, Napi::Number::New(env, f->contacts[i].y));
      arr.Set(i, c);
    }
    cb.Call({Napi::Number::New(env, f->t), arr});
    delete f;
  });
  if (status != napi_ok) delete frame;
  return 0;
}

void StopLocked() {
  if (!g_active) return;
  g_active = false;
  if (g_devices) {
    CFIndex n = CFArrayGetCount(g_devices);
    for (CFIndex i = 0; i < n; i++) {
      MTDeviceRef dev = (MTDeviceRef)CFArrayGetValueAtIndex(g_devices, i);
      MTUnregisterContactFrameCallback(dev, OnFrame);
      MTDeviceStop(dev);
    }
    CFRelease(g_devices);
    g_devices = nullptr;
  }
  g_tsfn.Release();
  g_last.clear();
}

Napi::Value Start(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  if (info.Length() < 1 || !info[0].IsFunction()) {
    Napi::TypeError::New(env, "start(callback) expects a function").ThrowAsJavaScriptException();
    return env.Undefined();
  }
  std::lock_guard<std::mutex> lock(g_mutex);
  if (g_active) return Napi::Boolean::New(env, true);
  if (!LoadFramework()) return Napi::Boolean::New(env, false);

  CFArrayRef devices = MTDeviceCreateList();
  if (!devices || CFArrayGetCount(devices) == 0) {
    if (devices) CFRelease(devices);
    return Napi::Boolean::New(env, false);
  }

  g_tsfn = Napi::ThreadSafeFunction::New(env, info[0].As<Napi::Function>(), "trackpad-frames", 0, 1);
  g_devices = devices;
  g_active = true;
  g_last.clear();
  CFIndex n = CFArrayGetCount(devices);
  for (CFIndex i = 0; i < n; i++) {
    MTDeviceRef dev = (MTDeviceRef)CFArrayGetValueAtIndex(devices, i);
    MTRegisterContactFrameCallback(dev, OnFrame);
    MTDeviceStart(dev, 0);
  }
  return Napi::Boolean::New(env, true);
}

Napi::Value Stop(const Napi::CallbackInfo& info) {
  std::lock_guard<std::mutex> lock(g_mutex);
  StopLocked();
  return info.Env().Undefined();
}

Napi::Object Init(Napi::Env env, Napi::Object exports) {
  exports.Set("start", Napi::Function::New(env, Start));
  exports.Set("stop", Napi::Function::New(env, Stop));
  return exports;
}

}  // namespace

NODE_API_MODULE(trackpad, Init)
