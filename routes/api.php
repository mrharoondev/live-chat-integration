<?php

use App\Http\Controllers\Api\AuthController;
use App\Http\Controllers\Api\BlogController;
use App\Http\Controllers\Api\NilaqChatIdentityController;
use Illuminate\Support\Facades\Route;

Route::post('/register', [AuthController::class, 'register']);
Route::post('/login', [AuthController::class, 'login']);

// Public blogs
Route::get('/blogs', [BlogController::class, 'index']);
Route::get('/blogs/{id}', [BlogController::class, 'show']);

/** NilaQ live-chat-sdk: optional Bearer — returns signed identity when logged in */
Route::get('/nilaq/chat-identity', [NilaqChatIdentityController::class, 'show']);

// Protected
Route::middleware('auth:sanctum')->group(function () {
    Route::post('/blogs', [BlogController::class, 'store']);
    Route::post('/logout', [AuthController::class, 'logout']);
});

