<?php

use App\Http\Controllers\ProfileController;
use Illuminate\Support\Facades\Route;
use App\Http\Controllers\BlogController;
use Illuminate\Support\Facades\Auth;

Route::get('/', function () {
    return view('welcome');
});

Route::get('/widget-config.js', function () {
    $apiDomain = rtrim((string) config('services.nilaq.api_domain', ''), '/');
    $channelId = trim((string) config('services.nilaq.channel_id', ''));
    $secureMode = (bool) config('services.nilaq.secure_mode', false);
    $secureSecret = (string) config('services.nilaq.secure_secret', '');

    $cfg = [
        'apiDomain' => $apiDomain,
        'channelId' => $channelId,
    ];

    $user = Auth::user();
    if ($secureMode && $user && $secureSecret) {
        $externalId = (string) ($user->id ?? '');
        $email = (string) ($user->email ?? '');
        $name = (string) ($user->name ?? '');

        $identifier = $externalId !== '' ? $externalId : strtolower($email);

        if ($identifier !== '') {
            $cfg['user'] = array_filter([
                'external_id' => $externalId !== '' ? $externalId : null,
                'email' => $email !== '' ? $email : null,
                'name' => $name !== '' ? $name : null,
            ], fn ($v) => $v !== null);

            $cfg['userHash'] = hash_hmac('sha256', $identifier, $secureSecret);
        }
    }

    $js = '(function(){window.ChatWidgetConfig=' . json_encode($cfg, JSON_UNESCAPED_SLASHES) . ';})();';

    return response($js, 200)
        ->header('Content-Type', 'application/javascript; charset=UTF-8')
        ->header('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');
})->name('widget-config');

Route::get('/chat-widget.js', function () {
    $path = base_path('chat-widget.js');
    if (!is_file($path)) {
        abort(404);
    }

    return response()->file($path, [
        'Content-Type' => 'application/javascript; charset=UTF-8',
        'Cache-Control' => 'no-store, no-cache, must-revalidate, max-age=0',
    ]);
})->name('chat-widget');

Route::middleware('auth')->group(function () {
    Route::get('/profile', [ProfileController::class, 'edit'])->name('profile.edit');
    Route::patch('/profile', [ProfileController::class, 'update'])->name('profile.update');
    Route::delete('/profile', [ProfileController::class, 'destroy'])->name('profile.destroy');
});

// Public blog view
Route::get('/blogs', [BlogController::class, 'index']);
Route::get('/blogs/{id}', [BlogController::class, 'show'])->name('blogs.show');
Route::get('/blogs/{id}/edit', [BlogController::class, 'edit'])->name('blogs.edit');

// Auth required (match Breeze: verified users for dashboard area)
Route::prefix('/dashboard')->middleware(['auth', 'verified'])->group(function () {
    Route::get('/', [BlogController::class, 'dashboard'])->name('dashboard');

    Route::get('/blogs/create', [BlogController::class, 'create'])->name('blogs.create');
    Route::post('/blogs/store', [BlogController::class, 'store'])->name('blogs.store');
    Route::post('/blogs/{id}/update', [BlogController::class, 'update'])->name('blogs.update');
    Route::delete('/blogs/{id}', [BlogController::class, 'destroy'])->name('blogs.destroy');
});

require __DIR__.'/auth.php';
