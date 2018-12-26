#!/bin/bash

HOSTS=$(cat `dirname $BASH_SOURCE`/../etc/cluster_hosts)

for f in $HOSTS
do 
  ssh $f 'cd code/node-ispc; npm stop' &
done

wait &