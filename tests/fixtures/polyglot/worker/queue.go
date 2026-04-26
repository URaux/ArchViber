// Queue abstraction backing the worker.
package main

import (
	"context"
	"errors"

	"github.com/redis/go-redis/v9"
)

// Queue is the interface the dispatcher uses to fetch and ack jobs.
type Queue interface {
	Pop(ctx context.Context) (*Job, error)
	Ack(ctx context.Context, jobID string) error
	Fail(ctx context.Context, jobID string, reason string) error
}

// Job is what flows through the pipeline.
type Job struct {
	ID      string
	Payload map[string]string
}

// RedisQueue implements Queue against a Redis stream.
type RedisQueue struct {
	rdb *redis.Client
}

// NewRedisQueue wires a queue against the supplied client.
func NewRedisQueue(rdb *redis.Client) *RedisQueue {
	return &RedisQueue{rdb: rdb}
}

// Pop blocks until a job is available or ctx is cancelled.
func (q *RedisQueue) Pop(ctx context.Context) (*Job, error) {
	res, err := q.rdb.BLPop(ctx, 0, "jobs").Result()
	if err != nil {
		return nil, err
	}
	if len(res) < 2 {
		return nil, errors.New("malformed BLPOP response")
	}
	return &Job{ID: res[1]}, nil
}

// Ack marks a job complete.
func (q *RedisQueue) Ack(ctx context.Context, jobID string) error {
	return q.rdb.HSet(ctx, "job:"+jobID, "status", "done").Err()
}

// Fail marks a job failed with a recorded reason.
func (q *RedisQueue) Fail(ctx context.Context, jobID string, reason string) error {
	return q.rdb.HSet(ctx, "job:"+jobID, "status", "failed", "reason", reason).Err()
}
