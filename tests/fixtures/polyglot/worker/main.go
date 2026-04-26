// Worker entry point — polls the queue and dispatches handlers.
package main

import (
	"context"
	"log"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/redis/go-redis/v9"
)

func main() {
	rdb := redis.NewClient(&redis.Options{Addr: os.Getenv("REDIS_ADDR")})
	defer rdb.Close()

	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()

	queue := NewRedisQueue(rdb)
	dispatcher := NewDispatcher(queue)

	if err := dispatcher.Run(ctx); err != nil {
		log.Fatalf("worker died: %v", err)
	}
}

// PollInterval is the default backoff between empty-queue polls.
const PollInterval = 250 * time.Millisecond
